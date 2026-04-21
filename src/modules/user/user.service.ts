import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto, UpdateUserRoleDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { FindOneOptions, IsNull, Repository } from 'typeorm';
import { PendingUser } from './entities/pendingUser.entity';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { extractPublicId } from 'cloudinary-build-url';
import { CreateUserDto } from './dto/create-user.dto';
import { UserInfo } from 'src/auth/dto/create-auth.dto';
import { genSaltSync, hashSync } from 'bcryptjs';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { MailerService } from '@nestjs-modules/mailer';
import { RoleEnum } from 'src/constants/role.enum';
import { Role as UserRole } from '../role/entities/role.entity';
import QueryUserDto from './dto/query-user.dto';
import { SortOrder } from 'src/constants/sortOrder.enum';
import { isUUID } from 'class-validator';
import { convertToTimeStampPostgres } from 'src/helpers/datetime.format';
// import { MarketService } from '../market/market.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(PendingUser)
    private pendingUserRepository: Repository<PendingUser>,
    private cloudinaryService: CloudinaryService,
    @InjectRepository(UserRole)
    private roleRepository: Repository<UserRole>,

    private readonly mailerService: MailerService,
  ) {}

  // code cũ của trường
  getUser = async (id: string) => {
    const user = await this.usersRepository.findOne({
      where: {
        id: id || IsNull(),
      },
    });

    return user;
  };
  ///
  getUser1 = async (email: string) => {
    const user = await this.usersRepository.findOne({
      relations: ['Roles', 'Roles.permissions'],
      where: {
        email: email,
      },
    });

    return user;
  };
  // cho admin
  async createUser(createUserDto: CreateUserDto, req: any) {
    try {
      if (!createUserDto.password) {
        createUserDto.password = '123456';
      }
      const { password, email, role } = createUserDto;
      // Kiểm tra xem email đã tồn tại trong cơ sở dữ liệu chưa
      const existingUser = await this.usersRepository.findOne({
        where: { email },
      });

      if (existingUser) {
        throw new ConflictException('Đã tồn tại người dùng với email này');
      }

      // hash
      const saltRounds = 10;
      const salt = genSaltSync(saltRounds);
      const hash = hashSync(password, salt);
      // compareSync("B4c0/\/", hash); // true

      // Lưu vào database và đợi kết quả
      createUserDto.password = hash;
      const codeId = uuidv4();

      const user_role = await this.roleRepository.findOne({
        where: { name: createUserDto.role },
      });
      const user = this.usersRepository.create({
        ...createUserDto,
        Roles: [user_role],

        // kích hoạt luôn
        isActice: true,
        codeId: codeId.slice(0, 4),
        codeExprided: dayjs().add(5, 'minutes').toDate(),
      });

      const userInfo = await this.usersRepository.save(user);
      // Trả mã password  về email khi người dùng được đăng ký thành công
      this.mailerService.sendMail({
        to: userInfo.email, // list of receivers
        from: 'noreply@nestjs.com', // sender address
        subject: 'Account Successfully Created at minhdeptrai.site ✔', // Subject line

        template: './createAccount',
        context: {
          name: userInfo.username ?? userInfo.email,
          password: password,
        },
      });
      const { password: _, ...userWithoutPassword } = user;
      return {
        status: 200,
        message: 'Tạo User thành công',
        data: {
          id: user.id,
          // role: userWithoutPassword.role,
          username: userWithoutPassword.username,
          email: userWithoutPassword.email,
          age: userWithoutPassword.age,
          address: userWithoutPassword.address,
          avatarUrl: userWithoutPassword.avatarUrl,
          phoneNumber: userWithoutPassword.phoneNumber,
          gender: userWithoutPassword.gender,
        },
      };
    } catch (error) {
      // Xử lý lỗi tùy thuộc vào loại lỗi
      if (error instanceof HttpException) {
        throw error; // Ném lại lỗi HttpException
      }
      // Xử lý các lỗi không lường trước
      throw new InternalServerErrorException('Something went wrong.');
    }
  }
  // tạo 1 mảng nhiều customer
  async createManyUsers(createUserDto: CreateUserDto[], req) {
    const emails = createUserDto.map((u) => u.email);

    // Tìm những email đã tồn tại trong database
    const existingUsers = await this.usersRepository
      .createQueryBuilder('user')
      .where('user.email IN (:...emails)', { emails })
      .select(['user.email'])
      .getMany();

    // Lấy danh sách email đã tồn tại
    const existingEmails = new Set(existingUsers.map((u) => u.email));

    // Lọc ra những user hợp lệ (email chưa tồn tại)
    const validUsers = createUserDto.filter(
      (u) => !existingEmails.has(u.email),
    );
    const invalidEmails = createUserDto
      .filter((u) => existingEmails.has(u.email))
      .map((u) => u.email);

    // chèn vào database user hợp lệ
    for (const item of validUsers) {
      if (!item.password) {
        item.password = '123456';
      }
      const { password, email, role } = item;
      // Kiểm tra xem email đã tồn tại trong cơ sở dữ liệu chưa
      const existingUser = await this.usersRepository.findOne({
        where: { email },
      });
      if (existingUser) {
        throw new ConflictException('Đã tồn tại người dùng với email này');
      }

      // hash
      const saltRounds = 10;
      const salt = genSaltSync(saltRounds);
      const hash = hashSync(password, salt);
      // compareSync("B4c0/\/", hash); // true

      // Lưu vào database và đợi kết quả
      item.password = hash;
      const codeId = uuidv4();

      const user_role = await this.roleRepository.findOne({
        where: { name: item.role },
      });
      const user = this.usersRepository.create({
        ...item,
        Roles: [user_role],

        // kích hoạt luân
        isActice: true,
        codeId: codeId.slice(0, 4),
        codeExprided: dayjs().add(5, 'minutes').toDate(),
      });

      const userInfo = await this.usersRepository.save(user);
    }

    return {
      successCount: validUsers.length,
      errorCount: invalidEmails.length,
      errorEmails: invalidEmails,
    };
  }

  // customer
  async createUser1(createUserDto: UserInfo) {
    const user = this.usersRepository.create(createUserDto);
    return await this.usersRepository.save(user);
  }

  // tìm thông qua email
  async findUserbyEmail(createUserDto) {
    const { email } = createUserDto;

    // Kiểm tra xem email đã tồn tại trong cơ sở dữ liệu chưa
    const existingUser = await this.usersRepository.findOne({
      where: { email },
    });

    return existingUser;
  }

  async findUserbyEmailAndCodeId({
    email,
    codeId,
  }: {
    email: string;
    codeId: string;
  }) {
    const user = await this.usersRepository.findOne({
      where: {
        email: email,
        codeId: codeId, // Thêm codeId vào điều kiện tìm kiếm
      },
    });

    return user;
  }

  async removePendingUserByNonce(nonce: string) {
    const foundNonce = await this.pendingUserRepository.findOne({
      where: { nonce },
    });

    if (foundNonce) {
      await this.pendingUserRepository.remove(foundNonce);
      return foundNonce;
    }
    return null;
  }

  async updateRole(id: string, updateUserRoleDto: UpdateUserRoleDto, req) {
    try {
      // Tìm kiếm user theo ID
      const user = await this.usersRepository.findOne({ where: { id } });

      // Nếu không tìm thấy user, trả về lỗi
      if (!user) throw new NotFoundException('Invalid user ID');

      // admin quản lí

      // Lấy role từ DTO
      const { Roles } = updateUserRoleDto;
      // Nếu vai trò mới là ADMIN nhưng người gửi yêu cầu không phải là ADMIN, cấm cập nhật
      if (Roles === RoleEnum.ADMIN && req.role !== RoleEnum.ADMIN) {
        throw new ForbiddenException('Only admin can assign admin role');
      }
      // Cập nhật role cho user
      user.Roles[0].name = Roles;
      await this.usersRepository.save(user);
      const { codeId, codeExprided, ...user1 } = user;
      // Trả về dữ liệu user đã cập nhật
      return {
        message: 'User role updated successfully',
        user1,
      };
    } catch (error) {
      // Xử lý lỗi cụ thể và tái ném lại nếu cần
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      // Bắt tất cả lỗi khác
      throw new InternalServerErrorException('Something went wrong');
    }
  }

  async uploadAvatar(file: Express.Multer.File, user: any) {
    // return user;
    const { email } = user;
    const userInfo = await this.getUser1(email);
    const publicId = extractPublicId(userInfo.avatarUrl);

    if (publicId !== 'User/default') {
      await this.cloudinaryService.removeFile(publicId);
    }
    const folder = 'user';
    const uploadResult = await this.cloudinaryService.uploadFile(file, folder);

    await this.usersRepository.update(userInfo.id, {
      avatarUrl: uploadResult.url,
    });
    // Chỉ lấy `public_id` và `url`
    const { public_id, url } = uploadResult;
    // Trả về `public_id` và `url`
    return { url, public_id };
  }

  async findAllPendingUser() {
    return await this.pendingUserRepository.find();
  }

  async uploadImage(image: Express.Multer.File) {
    const folder = 'Users/UserImage';
    const uploadResult = await this.cloudinaryService.uploadFile(image, folder);

    return {
      public_id: uploadResult.public_id,
      url: uploadResult.url,
    };
  }
  async findOne(conditions: { id: string; codeId: string }) {
    const options: FindOneOptions<User> = {
      where: { id: conditions.id, codeId: conditions.codeId },
    };

    const user = await this.usersRepository.findOne(options);
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto, req: any) {
    try {
      //  const { email } = updateUserDto;
      // Kiểm tra xem người dùng có tồn tại không
      const existingUser = await this.usersRepository.findOne({
        where: { id },
        relations: ['Roles', 'permissions'],
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }
      const objectRole = await this.roleRepository.findOne({
        where: { name: updateUserDto.Roles },
      });
      if (!objectRole) {
        throw new NotFoundException('Không tìm thấy role');
      }

      const { Roles, ...updateUser } = updateUserDto;
      const updatedUser = await this.usersRepository.save({
        ...existingUser,
        ...updateUser,
        id: existingUser.id, // đảm bảo id không bị thay đổi
        Roles: [objectRole],
      });
      const { password, ...data } = updatedUser;
      return {
        status: 200,
        message: 'Thành công cập nhật',
        data: data,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Ném lại lỗi để giữ nguyên phản hồi
      }
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new InternalServerErrorException('Something went wrong');
    }
  }

  async remove(id: string) {
    try {
      // Kiểm tra xem người dùng có tồn tại không
      const existingUser = await this.usersRepository.findOne({
        where: { id },
      });

      if (!existingUser) {
        throw new NotFoundException('User not found');
      }
      const publicId = extractPublicId(existingUser.avatarUrl);
      if (publicId !== 'User/default') {
        await this.cloudinaryService.removeFiles([publicId]);
      }
      if (!existingUser) {
        throw new NotFoundException('User not found');
      }

      // Thực hiện xóa người dùng
      await this.usersRepository.remove(existingUser);

      return {
        status: 200,
        message: 'User removed successfully',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error; // Ném lại lỗi để giữ nguyên phản hồi
      }
      // Nếu có lỗi ngoài ý muốn, ném lỗi server
      throw new InternalServerErrorException('Something went wrong');
    }
  }

  async getBettingHistory(walletAddress: string) {
    try {
      const user = await this.getUser(walletAddress);
      // const bettingHistory =
      //   await this.marketService.getUserBettingHistory(walletAddress);
      return {
        user: {
          username: user.username,
        },
        // bets: bettingHistory,
      };
    } catch (error) {
      console.error('Error in get user betting history:', error);
      throw new InternalServerErrorException(
        'Error in get user betting history',
      );
    }
  }
  async getAll(queryDto: QueryUserDto) {
    const {
      current = 1,
      pageSize = 10,
      sortOrder = SortOrder.DESC,
      ...filters
    } = queryDto;
    const start = (current - 1) * pageSize;
    const limit = pageSize;
    const query = this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.Roles', 'role')
      .leftJoinAndSelect('role.permissions', 'permission');

    if (filters.search && filters.search.trim() !== '') {
      const conditions: string[] = [];
      const params: Record<string, any> = {
        search: `%${filters.search.trim()}%`,
      };
      if (isUUID(filters.search)) {
        conditions.push(`user.id = :searchExact`);
        params.searchExact = filters.search;
      }
      conditions.push(
        `user.username ILIKE :search OR user.email ILIKE :search`,
      );
      conditions.push(
        `user.phoneNumber ILIKE :search OR user.address ILIKE :search`,
      );
      query.andWhere(`(${conditions.join(' OR ')})`, params);
    }

    if (filters.created_from && filters.created_to) {
      const from = convertToTimeStampPostgres(filters.created_from);
      const to = convertToTimeStampPostgres(filters.created_to);
      if (from <= to) {
        query.andWhere('user.createdAt BETWEEN :from AND :to', {
          from,
          to,
        });
      } else {
        throw new BadRequestException(
          'created_from must be less than or equal to created_to',
        );
      }
    }

    if (filters.status !== undefined) {
      query.andWhere('user.isActice = :status', {
        status: filters.status,
      });
    }

    if (filters.role) {
      if (filters.role !== RoleEnum.USER) {
        query.andWhere('role.name = :role', {
          role: filters.role,
        });
      } else {
        query.andWhere('role.name != :excludedRole', {
          excludedRole: RoleEnum.USER,
        });
      }
    }

    const [resultData, total] = await query
      .orderBy('user.updatedAt', sortOrder === SortOrder.ASC ? 'ASC' : 'DESC')
      .skip(start)
      .take(limit)
      .getManyAndCount();
    const total_page = Math.ceil(total / pageSize);
    const data = resultData.map((user) => {
      return {
        id: user.id,
        username: user.username,
        email: user.email,
        age: user.age,
        address: user.address,
        avatarUrl: user.avatarUrl,
        phoneNumber: user.phoneNumber,
        birthday: user.birthday,
        gender: user.gender,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        isActive: user.isActice,
        roles: user.Roles?.map((role) => ({
          id: role.id,
          name: role.name,
          permissions: role.permissions?.map((permission) => ({
            id: permission.id,
            name: permission.name,
            path: permission.path,
            method: permission.method,
            module: permission.module,
          })),
        })),
      };
    });
    return {
      message: 'Lấy danh sách người dùng thành công',
      status: 200,
      data: {
        data: data,
        meta: {
          current_page: current,
          page_size: pageSize,
          total: total,
          total_page: total_page,
        },
      },
    };
  }

  async getFindById(id: string) {
    const user = await this.usersRepository.findOne({
      where: { id: id },
      relations: ['Roles', 'Roles.permissions'],
      select: [
        'id',
        'username',
        'birthday',
        'email',
        'age',
        'address',
        'avatarUrl',
        'isActice',
        'phoneNumber',
        'gender',
        'createdAt',
        'updatedAt',
      ],
    });

    // Chỉ trả về thông tin cần thiết, bỏ password
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      birthday: user.birthday,
      age: user.age,
      address: user.address,
      phoneNumber: user.phoneNumber,
      gender: user.gender,
      avatarUrl: user.avatarUrl,
      isActive: user.isActice,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      codeId: user.codeId,
      codeExprided: user.codeExprided,
      roles: user.Roles?.map((role) => ({
        id: role.id,
        name: role.name,
        permissions: role.permissions?.map((permission) => ({
          id: permission.id,
          name: permission.name,
          path: permission.path,
          method: permission.method,
          module: permission.module,
        })),
      })),
    };
  }
}
