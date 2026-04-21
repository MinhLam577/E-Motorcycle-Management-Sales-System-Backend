import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Brand } from './entities/brand.entity';
import { ILike, Repository } from 'typeorm';
import { isUUID, IsUUID } from 'class-validator';
import aqp from 'api-query-params';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { extractPublicId } from 'cloudinary-build-url';
import QueryBrandDto from './dto/query-brand.dto';
import { SortOrder } from 'src/constants/sortOrder.enum';
import { convertToTimeStampPostgres } from 'src/helpers/datetime.format';

@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(Brand)
    private brandsRepository: Repository<Brand>,
    private cloudinaryService: CloudinaryService,
  ) {}

  async create(createBrandDto: CreateBrandDto) {
    try {
      const newBrand = this.brandsRepository.create(createBrandDto);
      return await this.brandsRepository.save(newBrand);
    } catch (error) {
      throw error;
    }
  }

  async findAll(paginationQuery: QueryBrandDto) {
    {
      const {
        current = 1,
        pageSize = 10,
        sortOrder = SortOrder.DESC,
        ...filters
      } = paginationQuery;

      try {
        const queryBuilder = this.brandsRepository.createQueryBuilder('brand');

        if (filters.search) {
          const searchInput = filters.search.trim();
          if (isUUID(searchInput)) {
            queryBuilder.andWhere('brand.id = :id', { id: searchInput });
          } else {
            queryBuilder.andWhere(
              '(brand.name ILIKE :search OR brand.description ILIKE :search OR brand.slug ILIKE :search)',
              {
                search: `%${searchInput}%`,
              },
            );
          }
        }

        if (filters.created_from && filters.created_to) {
          const from = convertToTimeStampPostgres(filters.created_from);
          const to = convertToTimeStampPostgres(filters.created_to);
          if (from <= to) {
            queryBuilder.andWhere('brand.createdAt BETWEEN :from AND :to', {
              from,
              to,
            });
          } else {
            throw new BadRequestException(
              'Ngày tạo phải nhỏ hơn hoặc bằng ngày kết thúc',
            );
          }
        }
        // Sử dụng các filter và sort cho findAndCount
        const [results, totalItems] = await queryBuilder
          .take(pageSize)
          .skip((current - 1) * pageSize)
          .orderBy(
            'brand.updated_at',
            sortOrder === SortOrder.ASC ? 'ASC' : 'DESC',
          )
          .getManyAndCount();
        const totalPages = Math.ceil(totalItems / pageSize);
        return {
          pagination: {
            total: totalItems,
            pageSize,
            current,
            totalPages,
          },
          result: results,
        };
      } catch (error) {
        throw error;
      }
    }
  }
  async findOne(id: string) {
    try {
      const brand = await this.brandsRepository.findOneBy({ id });

      // Kiểm tra nếu không tìm thấy bản ghi
      if (!brand) {
        throw new NotFoundException(`Brand with ID ${id} not found`);
      }

      return brand;
    } catch (error) {
      throw error;
    }
  }

  async update(id: string, updateBrandDto: UpdateBrandDto): Promise<Brand> {
    try {
      // Tìm bản ghi cần cập nhật
      const brand = await this.brandsRepository.findOne({ where: { id } });

      if (!brand) {
        throw new NotFoundException(`Brand with ID ${id} not found`);
      }

      // Cập nhật dữ liệu
      const updatedBrand = Object.assign(brand, updateBrandDto);

      // Lưu vào cơ sở dữ liệu
      return await this.brandsRepository.save(updatedBrand);
    } catch (error) {
      console.error('Error while updating brand:', error);
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    // Kiểm tra xem bản ghi có tồn tại không
    const brand = await this.brandsRepository.findOne({ where: { id } });

    if (!brand) {
      throw new NotFoundException(`Brand with ID ${id} not found`); // Ném lỗi nếu không tìm thấy
    }
    // Nếu tồn tại thì xóa bản ghi
    const public_id = extractPublicId(brand.thumbnailUrl);
    this.cloudinaryService.removeFile(public_id);
    await this.brandsRepository.delete(id);
  }
  async uploadImage(image: Express.Multer.File) {
    const folder = 'Brand/brandImage';
    const uploadResult = await this.cloudinaryService.uploadFile(image, folder);

    return {
      public_id: uploadResult.public_id,
      url: uploadResult.url,
    };
  }
  async updateThumbnail(id: string, file: Express.Multer.File) {
    // const blog = await this.validateUserOwner(id);
    const brand = await this.brandsRepository.findOne({ where: { id } });

    const public_id = extractPublicId(brand.thumbnailUrl);

    this.cloudinaryService.removeFile(public_id);

    const folder = 'Brand/brandImage';

    const uploadReponse = await this.cloudinaryService.uploadFile(file, folder);

    brand.thumbnailUrl = uploadReponse.url;
    this.brandsRepository.save(brand);
    return {
      public_id: uploadReponse.public_id,
      url: uploadReponse.url,
    };
  }

  async convertToBase64FromUrl(url: string): Promise<string> {
    try {
      if (!url || !url.match(/^https?:\/\//)) {
        throw new BadRequestException('URL không hợp lệ');
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new BadRequestException('URL không hợp lệ hoặc không tồn tại');
      }

      const arrayBuffer = await response.arrayBuffer();
      const mimeType =
        response.headers.get('content-type') || 'application/octet-stream';
      const base64String = Buffer.from(arrayBuffer).toString('base64');
      return `data:${mimeType};base64,${base64String}`;
    } catch (error) {
      throw error;
    }
  }
}
