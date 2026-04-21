import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { Branch } from './entities/branch.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import aqp from 'api-query-params';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { extractPublicId } from 'cloudinary-build-url';
import { isUUID } from 'class-validator';
import { Warehouse } from '../warehouse/entities/warehouse.entity';

@Injectable()
export class BranchService {
  constructor(
    @InjectRepository(Branch)
    private readonly branchRepository: Repository<Branch>,
    private cloudinaryService: CloudinaryService,
    @InjectRepository(Warehouse)
    private wareHouseRepo: Repository<Warehouse>,
  ) {}
  async create(createBranchDto: CreateBranchDto) {
    const { wareHouses, ...CreateBranch } = createBranchDto;

    const arrayWarehouse = [];
    for (const warehouse_id of wareHouses) {
      const foundWarehouse = await this.wareHouseRepo.findOne({
        where: { id: warehouse_id.id },
      });

      if (!foundWarehouse) {
        throw new NotFoundException(
          `Warehouse with ID ${warehouse_id.id} not found`,
        );
      }
      arrayWarehouse.push(foundWarehouse);
    }
    const newBranch = this.branchRepository.create({
      ...CreateBranch,
      wareHouses: arrayWarehouse,
    });
    const data = await this.branchRepository.save(newBranch);
    return {
      status: 200,
      message: 'Tạo mới chi nhánh thành công',
      data,
    };
  }
  async findAll(paginationQuery) {
    // Parse filter và sort từ query
    const { filter, sort } = aqp(paginationQuery);
    let { pageSize, current, q, ...restFilter } = filter;

    // Nếu không có pageSize và current -> Trả về tất cả
    if (!pageSize || !current) {
      const results = await this.branchRepository.find({
        where: restFilter,
        order: sort,
      });
      return {
        data: results,
        pagination: null, // Không có phân trang
      };
    }

    // Chuyển đổi sang số và kiểm tra hợp lệ
    pageSize = Number(pageSize);
    current = Number(current);

    if (isNaN(pageSize) || pageSize <= 0) pageSize = 10; // Giá trị mặc định
    if (isNaN(current) || current <= 0) current = 1;

    const [results, totalItems] = await this.branchRepository.findAndCount({
      where: restFilter,
      order: sort,
      take: pageSize,
      skip: (current - 1) * pageSize,
    });

    return {
      data: results,
      pagination: {
        total: totalItems,
        pageSize,
        current,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }

  async findOne(id: string) {
    // Sử dụng FindOneOptions để truy vấn theo ID
    if (!isUUID(id)) {
      return new Error('Invalid UUID format');
    }
    const branch = await this.branchRepository.findOne({
      where: { id }, // Tìm kiếm theo trường id
      relations: ['wareHouses'],
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }
    return branch;
  }

  async update(id: string, updateBranchDto: UpdateBranchDto) {
    const { wareHouses, ...updateBranchData } = updateBranchDto;

    // Tìm chi nhánh theo ID
    const branch = await this.branchRepository.findOne({
      where: { id },
      relations: ['wareHouses'], // Load luôn quan hệ để xóa
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }

    // Xóa hết dữ liệu trong bảng trung gian
    branch.wareHouses = [];
    await this.branchRepository.save(branch);

    // Nếu có warehouse_ids mới, thêm lại vào bảng trung gian
    if (wareHouses && wareHouses.length > 0) {
      const warehouses = await this.wareHouseRepo.findByIds(wareHouses);

      if (warehouses.length !== wareHouses.length) {
        throw new NotFoundException(`One or more warehouses not found`);
      }
      branch.wareHouses = warehouses;
    }

    // Cập nhật thông tin chi nhánh
    Object.assign(branch, updateBranchData);
    return await this.branchRepository.save(branch);
  }

  async remove(id: string) {
    // Kiểm tra xem bản ghi có tồn tại không
    if (!isUUID(id)) {
      return new Error('Invalid UUID format');
    }
    const branch = await this.branchRepository.findOne({ where: { id } });

    if (!branch) {
      return new NotFoundException(`Branch with ID ${id} not found`);
    } // Ném lỗi nếu không tìm thấy

    // Nếu tồn tại thì xóa bản ghi
    const public_id = extractPublicId(branch.logo);
    this.cloudinaryService.removeFile(public_id);
    return await this.branchRepository.delete(id);
  }

  async uploadImage(image: Express.Multer.File) {
    const folder = 'Branch/branchImage';
    const uploadResult = await this.cloudinaryService.uploadFile(image, folder);

    return {
      public_id: uploadResult.public_id,
      url: uploadResult.url,
    };
  }
  async updateThumbnail(id: string, file: Express.Multer.File) {
    // const blog = await this.validateUserOwner(id);
    const brand = await this.branchRepository.findOne({ where: { id } });

    const public_id = extractPublicId(brand.logo);

    this.cloudinaryService.removeFile(public_id);

    const folder = 'Brand/brandImage';

    const uploadReponse = await this.cloudinaryService.uploadFile(file, folder);

    brand.logo = uploadReponse.url;
    this.branchRepository.save(brand);
    return {
      public_id: uploadReponse.public_id,
      url: uploadReponse.url,
    };
  }
}
